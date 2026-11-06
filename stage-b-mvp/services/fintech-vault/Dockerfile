FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# hardhat writes to its cache and to deployments/ at runtime
RUN mkdir -p deployments && chown -R node:node /app
USER node
# compile once at build time so the abi json the routes import is in the image
RUN npx hardhat compile
EXPOSE 3002
# fresh hardhat chain on every start, so deploy the contracts and then serve
CMD ["sh", "-c", "npx hardhat run scripts/deploy.ts --network localhost && npm start"]
