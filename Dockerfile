# Specify the base image
FROM node:18

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json into the working directory
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application code into the working directory
COPY *.js .

# Define the command to run the app
CMD [ "node", "index.js" ]