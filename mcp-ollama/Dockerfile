FROM node:18-slim

WORKDIR /app

# Copy everything first
COPY . .

# Install and build in one step to minimize network calls
RUN npm install && npm run build

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start application
CMD ["npm", "start"]