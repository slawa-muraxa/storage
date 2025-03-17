# Stage 1: Build the NestJS application
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install ALL dependencies, including devDependencies (required for NestJS CLI)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Ensure NestJS CLI is installed locally
RUN npx nest --version

# Build the application using npx to avoid global dependency issues
RUN npx nest build

# Stage 2: Production image with minimal size
FROM node:20-alpine AS production

# Install ffmpeg for runtime media processing (if needed)
RUN apk update && apk add --no-cache ffmpeg

ENV DOCKERIZE_VERSION=v0.8.0

RUN apk update --no-cache \
    && apk add --no-cache wget openssl \
    && wget -O - https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-alpine-linux-amd64-$DOCKERIZE_VERSION.tar.gz | tar xzf - -C /usr/local/bin \
    && apk del wget

WORKDIR /app

# Copy only the necessary production files from the build stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install only production dependencies in the final image
RUN npm ci --only=production

# Expose the application port
EXPOSE 3004

# Start the application
CMD ["node", "dist/main"]