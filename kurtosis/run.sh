#!/usr/bin/env bash
# End-to-end check of el-sync-driver against real clients using Kurtosis + ethereum-package.
#
#   kurtosis/run.sh <fulu|gloas>        bring up the devnet, stop participant 2's CL so its EL lags,
#                                       write kurtosis/config.<fork>.json and print how to start the driver
#   kurtosis/run.sh <fulu|gloas> status print head slot/block vs. the driven EL's block number
#   kurtosis/run.sh <fulu|gloas> docker run the driver as a docker container (el-sync-driver-<fork>) against the enclave
#   kurtosis/run.sh <fulu|gloas> down   destroy the enclave
set -euo pipefail

FORK="${1:?usage: run.sh <fulu|gloas> [status|down]}"
ACTION="${2:-up}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ENCLAVE="elsd-${FORK}"
CONFIG="${DIR}/config.${FORK}.json"

svc() { kurtosis enclave inspect "$ENCLAVE" | awk -v p="$1" '$2 ~ "^"p {print $2; exit}'; }
port() { kurtosis port print "$ENCLAVE" "$1" "$2"; }
head_slot() { curl -sf "$1/eth/v1/beacon/headers/head" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["header"]["message"]["slot"])'; }
head_fork() { curl -sf "$1/eth/v2/beacon/blocks/head" | python3 -c 'import sys,json; print(json.load(sys.stdin)["version"])'; }
head_el_block() { curl -sf "$1/eth/v2/beacon/blocks/head" | python3 -c '
import sys,json
b=json.load(sys.stdin)["data"]["message"]["body"]
p=b.get("execution_payload")
print(p["block_number"] if p else "bid:"+b["signed_execution_payload_bid"]["message"]["block_hash"][:10])'; }
el_block() { curl -sf -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$1" | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"],16))'; }

case "$ACTION" in
  down)
    kurtosis enclave rm -f "$ENCLAVE"
    exit 0
    ;;
  status)
    CL1="http://127.0.0.1:$(port "$(svc cl-1-)" http | sed 's#.*:##')"
    EL2="http://127.0.0.1:$(port "$(svc el-2-)" rpc | sed 's#.*:##')"
    echo "head: slot $(head_slot "$CL1") ($(head_fork "$CL1")) el block $(head_el_block "$CL1")"
    echo "driven EL ($(svc el-2-)): block $(el_block "$EL2")"
    exit 0
    ;;
  docker)
    # Inside a container the host's published ports are reachable via host.docker.internal, not 127.0.0.1.
    DOCKER_CONFIG="${DIR}/config.${FORK}.docker.json"
    sed -e 's#http://127.0.0.1:#http://host.docker.internal:#g' -e 's#"jwtSecretFile": "[^"]*"#"jwtSecretFile": "/secrets/jwtsecret"#' "$CONFIG" > "$DOCKER_CONFIG"
    NAME="el-sync-driver-${FORK}"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    (cd "${DIR}/.." && docker compose build --quiet)
    docker run -d --name "$NAME" --restart unless-stopped \
      -e LOG_LEVEL="${LOG_LEVEL:-info}" -e CONFIG=/config/config.json \
      -v "${DOCKER_CONFIG}:/config/config.json:ro" \
      -v "$(find "${DIR}/.jwt" -type f | head -1):/secrets/jwtsecret:ro" \
      el-sync-driver-el-sync-driver >/dev/null
    echo ">> started container ${NAME}. Follow logs with:  docker logs -f ${NAME}"
    exit 0
    ;;
  up) ;;
  *) echo "unknown action: $ACTION" >&2; exit 1 ;;
esac

if kurtosis enclave inspect "$ENCLAVE" >/dev/null 2>&1; then
  echo ">> enclave ${ENCLAVE} already exists, reusing it"
else
  echo ">> starting enclave ${ENCLAVE} from ${DIR}/${FORK}.yaml"
  kurtosis run --enclave "$ENCLAVE" github.com/ethpandaops/ethereum-package --args-file "${DIR}/${FORK}.yaml"
fi

CL1_SVC="$(svc cl-1-)"; CL2_SVC="$(svc cl-2-)"; EL2_SVC="$(svc el-2-)"
CL1="http://127.0.0.1:$(port "$CL1_SVC" http | sed 's#.*:##')"
EL2_ENGINE="http://127.0.0.1:$(port "$EL2_SVC" engine-rpc | sed 's#.*:##')"
EL2_RPC="http://127.0.0.1:$(port "$EL2_SVC" rpc | sed 's#.*:##')"
echo ">> CL1=${CL1_SVC} ${CL1}  EL2=${EL2_SVC} engine=${EL2_ENGINE} rpc=${EL2_RPC}"

echo ">> waiting for head to be a ${FORK} block (up to ${WAIT_FORK_TIMEOUT:-1200}s)..."
deadline=$(( $(date +%s) + ${WAIT_FORK_TIMEOUT:-1200} ))
until [ "$(head_fork "$CL1" 2>/dev/null || echo none)" = "$FORK" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "!! timed out waiting for a ${FORK} head" >&2; exit 1; fi
  sleep 6
done
echo ">> head is at slot $(head_slot "$CL1") (${FORK})"

echo ">> stopping ${CL2_SVC} so ${EL2_SVC} stops receiving payloads"
kurtosis service stop "$ENCLAVE" "$CL2_SVC" >/dev/null
echo ">> waiting ~5 slots for ${EL2_SVC} to fall behind"
sleep 60
echo ">> head el block: $(head_el_block "$CL1")   driven EL block: $(el_block "$EL2_RPC")"

echo ">> fetching jwt secret"
mkdir -p "${DIR}/.jwt"
find "${DIR}/.jwt" -mindepth 1 -delete
kurtosis files download "$ENCLAVE" jwt_file "${DIR}/.jwt" >/dev/null
JWT="$(find "${DIR}/.jwt" -type f | head -1)"

cat > "$CONFIG" <<JSON
{
  "ClRestApiEndpoint": "${CL1}",
  "ElJsonrpcEndpoints": [
    { "endpoint": "${EL2_ENGINE}", "jwtSecretFile": "${JWT}" }
  ]
}
JSON
echo ">> wrote ${CONFIG}"
echo
echo "Now run:   LOG_LEVEL=debug CONFIG=${CONFIG} npm start"
echo "   or:     kurtosis/run.sh ${FORK} docker      (then: docker logs -f el-sync-driver-${FORK})"
echo "Check:     kurtosis/run.sh ${FORK} status"
echo "Cleanup:   kurtosis/run.sh ${FORK} down"
