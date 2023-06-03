# EL Sync Driver

This tool is able to drive multiple execution layers to sync emulating a CL client.

The tool only requires to access an existing Consensus Client rest API.

```mermaid
graph LR
    B(EL-sync-driver) <-- block/head<br />fork_choice --> C[CL REST API]
    C -- beacon block head<br />finalized\justified data--> B
    B -- engine_newPayloadV2<br />engine_forkChoiceUpdatedV2 --> D[EL engine API]
```

## Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/tbenr/el-sync-driver.git
cd el-sync-driver
npm install
```
## Configuration

Specify a Consensus Layer rest API endpoint and the list of Execution Layers engine api endpoint and secret file

```json
{
    "ClRestApiEndpoint": "http://localhost:5051",
    "ElJsonrpcEndpoints": [
        {
            "endpoint": "http://localhost:8551",
            "jwtSecretFile": "/path/to/secret"
        }
    ]
}
```

## Usage
Start by running:

```bash
npm start
```

### output while driving
<img width="624" alt="image" src="https://github.com/tbenr/el-sync-driver/assets/15999009/5bf5d25c-561a-4595-82e6-3506508d8126">

## Disclaimer

This is an experimental tool and is provided as-is, without any kind of warranty or support. Use it at your own risk. The author and contributors of this project are not responsible for any damages or losses that may occur from the use of this tool. It is recommended to thoroughly review and test the code before using it in any production environment.

## Usage Notice

Please note that this tool is intended for educational and experimental purposes only. It is not recommended to use this tool in any critical or production systems. The tool may have limitations, known issues, or security vulnerabilities that have not been thoroughly tested or addressed.

## Contributing

Contributions to this project are welcome, but please understand that there may be no active maintenance or support for this tool. If you encounter any issues or have suggestions, you can submit them as GitHub issues, but there is no guarantee that they will be addressed or resolved.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

