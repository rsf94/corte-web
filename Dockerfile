# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- run ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone (si tu next.config lo soporta) sería ideal,
# pero para MVP arrancamos normal:
COPY --from=build /app ./

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
CMD ["npm","run","start"]
