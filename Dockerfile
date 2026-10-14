# 像素宠舍：常驻 Node 服务 + 一份持久化 JSON。
# 注意：这个应用需要一个「能长期运行的进程」和「一块可写、重启还在的磁盘」，
# 所以 Serverless / Vercel 那类无状态平台跑不了（详见 README）。
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    PET_DATA_FILE=/data/petshed.json

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# 数据落在挂载卷里，容器重建也不会丢
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:5173/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
