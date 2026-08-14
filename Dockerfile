FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV DOCUMENT_ROOT=/documents
ENV MAX_DOCUMENT_SIZE=100mb

EXPOSE 3000

CMD ["npm", "start"]
