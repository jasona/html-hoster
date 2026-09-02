FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
