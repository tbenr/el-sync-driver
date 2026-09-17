FROM node:22-alpine

WORKDIR /usr/src/app

# No runtime dependencies: only Node built-ins are used.
COPY package.json ./
COPY *.js ./

ENV LOG_LEVEL=info

CMD [ "node", "index.js" ]
