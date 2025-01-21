# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory to /app
WORKDIR /app

# Copy the package.json and package-lock.json files to the container
COPY package*.json ./

RUN apk add --no-cache python3 make g++ gcc

# Install dependencies
RUN npm install

# Copy the rest of the application code to the container
COPY . .

# Install nodemon globally
RUN npm install -g nodemon

# Expose port 4000 for the application
EXPOSE 4000

# Start the application using nodemon
CMD ["nodemon", "index.ts"]
