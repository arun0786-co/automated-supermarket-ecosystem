FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
# seed is insert-only, so running it on every start is safe
CMD ["sh", "-c", "node dist/db/seed.js && node dist/main.js"]
