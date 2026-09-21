FROM node:20-slim

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application source code
COPY . .

# Build Vite client assets
RUN npm run build

# Default environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose web port
EXPOSE 3000

# Run server with tsx runtime
CMD ["npm", "start"]
