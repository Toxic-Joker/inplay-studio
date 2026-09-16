FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source files
COPY server.js ./
COPY public/ ./public/

# Expose the single port the app uses
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
