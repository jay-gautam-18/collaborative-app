FROM node:20-alpine as frontend-dock

COPY ./frontend /app

WORKDIR /app

RUN npm install

RUN npm run build

FROM node:20-alpine

COPY ./backend /app

WORKDIR /app

RUN npm install

COPY --from=frontend-dock /app/dist /app/public

CMD ["npm", "start"]