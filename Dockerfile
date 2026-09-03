FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 9200

# No host port is published in docker-compose.yml on purpose. The service trusts
# the identity headers on every request, and that is only safe while the gateway
# is the sole route in. Publish this port and any caller can assert any partner
# id, making every usage record and audit entry attributable to the wrong
# organisation.
CMD ["node", "src/server.js"]
