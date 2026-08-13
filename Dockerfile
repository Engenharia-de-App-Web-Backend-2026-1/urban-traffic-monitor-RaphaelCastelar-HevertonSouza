FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY proto ./proto
COPY src ./src
USER node
CMD ["npm", "run", "start:ingestion"]
