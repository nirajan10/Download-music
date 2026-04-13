FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    xz-utils \
    libjpeg62-turbo-dev \
    zlib1g-dev \
    && curl -fsSL https://nodejs.org/dist/v20.19.1/node-v20.19.1-linux-x64.tar.xz \
       | tar -xJ --strip-components=2 -C /usr/local/bin 'node-v20.19.1-linux-x64/bin/node' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /downloads /data /root/.config/yt-dlp \
    && printf -- '--js-runtimes node\n--remote-components ejs:github\n' > /root/.config/yt-dlp/config \
    && yt-dlp --update-to yt-dlp-EJS@latest || true

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
