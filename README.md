# Защиты ДЗ по распределённым системам

Страницы для защиты домашних заданий: живые симуляции поверх настоящего кода решений, прогоны официальных тестов и общая доска, на которой все открывшие ссылку рисуют вместе и видят курсоры друг друга.

- [guarantees.maserov.com](https://guarantees.maserov.com) — ДЗ 1, гарантии доставки: AMO, ALO, EO и EOO, замеры ресурсов и баг в проверке порядка.
- [messenger.maserov.com](https://messenger.maserov.com) — ДЗ 2, мессенджер на gRPC: живой чат на настоящих `server.py` и двух `client.py`, гонки по шагам с поломками вроде «await внутри рассылки» и официальный прогон.
- [http.maserov.com](https://http.maserov.com) — ДЗ 3, HTTP-сервер: живой `server.py` с общей папкой и байтами запросов и ответов, разбор запроса по кускам, большие файлы и gzip по настоящим замерам памяти, дыры в тестах и официальный прогон.

Устанавливается из `masesmirnov/infra` скриптом `scripts/deploy_distsys.py` по файлам, закреплённым хешами в `locks/distsys.json`.

## Запуск

Нужен только Node.js 20+, зависимостей нет.

```sh
node server.js
```

Сервер слушает `127.0.0.1:8094` (`PORT` и `HOST` меняют адрес) и выбирает страницу по первой части имени хоста: `guarantees.localhost:8094`, `messenger.localhost:8094` или `http.localhost:8094`, любое другое имя открывает ДЗ 1. `public/shared/` общий, `public/<страница>/` — своё. Доска работает через SSE `/api/stream` и `POST /api/ops`, комнаты у каждой страницы свои; рисунки живут в памяти: общая комната хранит их до перезапуска, отдельные пропадают после суток без посетителей.

Живому чату нужны сервер и два клиента из `public/messenger/solution` и их адреса в `MESSENGER_CLIENTS`:

```sh
cd public/messenger
python -m solution.server.server
MESSENGER_SERVER_ADDR=127.0.0.1:51075 MESSENGER_HTTP_PORT=8096 python -m solution.client.client
MESSENGER_SERVER_ADDR=127.0.0.1:51075 MESSENGER_HTTP_PORT=8097 python -m solution.client.client
cd ../.. && MESSENGER_CLIENTS=127.0.0.1:8096,127.0.0.1:8097 node server.js
```

Пока страницу кто-то смотрит, сервер отправляет сообщения через `POST /sendMessage` клиентов и забирает их буферы `POST /getAndFlushMessages`. Клиент из заготовки курса читает тело запроса как ASCII, поэтому JSON уходит с экранированием `\uXXXX`.

Живому серверу ДЗ 3 нужен `server.py` из `public/http/solution`, его адрес в `HTTP_SERVER` и тот же домен, что у `--server-domain`, в `HTTP_DOMAIN`:

```sh
cd public/http/solution
python server.py --host 127.0.0.1 --port 8099 --working-directory /tmp/http-files --server-domain localhost
cd ../../.. && HTTP_SERVER=127.0.0.1:8099 HTTP_DOMAIN=localhost node server.js
```

Запросы со страницы идут в `POST /api/live`: сервер страницы сам собирает сырой HTTP-запрос, если попросили, режет его на три куска с паузами, отдаёт настоящему `server.py` и показывает байты ответа всем, кто смотрит. Пути только из латиницы, цифр, точки, дефиса и подчёркивания и не глубже трёх уровней, тело до 4000 символов, в папке не больше 40 объектов. Папку можно вернуть к исходной кнопкой, а после 15 минут без запросов она возвращается сама при следующем заходе.

## Данные

`public/guarantees/data/guarantees.py` — снимок решения ДЗ 1, симуляция показывает его строки. `public/guarantees/data/logs/` — логи прогонов Docker-образа курса: `full-4.0.log` с параметрами проверяющей системы `-m 100 -c -o`, остальные — `-o` для вариантов с другим `RESEND_DELAY` и другим хранением дырок. `public/guarantees/data/results.json` собирается из них, лимиты берутся из исходника тестов:

```sh
python scripts/guarantees_results.py public/guarantees/data/logs ../hse-2026/homework/01-guarantees/tests/src/common.rs "distsys.ru/course/guarantees@sha256:…" > public/guarantees/data/results.json
```

`public/messenger/solution/` — снимок решения ДЗ 2: его строки показывают гонки, его же запускает живой чат. `public/messenger/data/logs/full.log` — прогон `docker run --privileged … distsys.ru/course/grpc-messenger`, `public/messenger/data/results.json` собирается из него:

```sh
python scripts/messenger_results.py public/messenger/data/logs/full.log "distsys.ru/course/grpc-messenger@sha256:…" > public/messenger/data/results.json
```

`public/http/solution/` — снимок решения ДЗ 3: его строки показывают лабы, его же запускает живой сервер. `public/http/data/logs/full.log` — прогон `docker run --privileged … distsys.ru/course/http-server` без цветовых кодов терминала, `public/http/data/results.json` собирается из него:

```sh
python scripts/http_results.py public/http/data/logs/full.log "distsys.ru/course/http-server@sha256:…" > public/http/data/results.json
```

`public/http/data/memory.json` — память процесса решения и трёх поломок под `--memory=128m`, как у тестера: скрипт собирает образы из папки решения и гоняет POST 191 МиБ, GET 160 МиБ и GET 160 МиБ с gzip.

```sh
python scripts/http_memory.py ../hse-2026/homework/03-http-server/solution > public/http/data/memory.json
```
