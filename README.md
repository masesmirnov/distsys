# Защиты ДЗ по распределённым системам

Страницы для защиты домашних заданий: живые симуляции поверх настоящего кода решений, прогоны официальных тестов и общая доска, на которой все открывшие ссылку рисуют вместе и видят курсоры друг друга.

- [guarantees.maserov.com](https://guarantees.maserov.com) — ДЗ 1, гарантии доставки: AMO, ALO, EO и EOO, замеры ресурсов и баг в проверке порядка.
- [messenger.maserov.com](https://messenger.maserov.com) — ДЗ 2, мессенджер на gRPC: живой чат на настоящих `server.py` и двух `client.py`, гонки по шагам с поломками вроде «await внутри рассылки» и официальный прогон.

Устанавливается из `masesmirnov/infra` скриптом `scripts/deploy_distsys.py` по файлам, закреплённым хешами в `locks/distsys.json`.

## Запуск

Нужен только Node.js 20+, зависимостей нет.

```sh
node server.js
```

Сервер слушает `127.0.0.1:8094` (`PORT` и `HOST` меняют адрес) и выбирает страницу по первой части имени хоста: `guarantees.localhost:8094` или `messenger.localhost:8094`, любое другое имя открывает ДЗ 1. `public/shared/` общий, `public/<страница>/` — своё. Доска работает через SSE `/api/stream` и `POST /api/ops`, комнаты у каждой страницы свои; рисунки живут в памяти и пропадают после суток без посетителей.

Живому чату нужны сервер и два клиента из `public/messenger/solution` и их адреса в `MESSENGER_CLIENTS`:

```sh
cd public/messenger
python -m solution.server.server
MESSENGER_SERVER_ADDR=127.0.0.1:51075 MESSENGER_HTTP_PORT=8096 python -m solution.client.client
MESSENGER_SERVER_ADDR=127.0.0.1:51075 MESSENGER_HTTP_PORT=8097 python -m solution.client.client
cd ../.. && MESSENGER_CLIENTS=127.0.0.1:8096,127.0.0.1:8097 node server.js
```

Пока страницу кто-то смотрит, сервер отправляет сообщения через `POST /sendMessage` клиентов и забирает их буферы `POST /getAndFlushMessages`. Клиент из заготовки курса читает тело запроса как ASCII, поэтому JSON уходит с экранированием `\uXXXX`.

## Данные

`public/guarantees/data/guarantees.py` — снимок решения ДЗ 1, симуляция показывает его строки. `public/guarantees/data/logs/` — логи прогонов Docker-образа курса: `full-4.0.log` с параметрами проверяющей системы `-m 100 -c -o`, остальные — `-o` для вариантов с другим `RESEND_DELAY` и другим хранением дырок. `public/guarantees/data/results.json` собирается из них, лимиты берутся из исходника тестов:

```sh
python scripts/guarantees_results.py public/guarantees/data/logs ../hse-2026/homework/01-guarantees/tests/src/common.rs "distsys.ru/course/guarantees@sha256:…" > public/guarantees/data/results.json
```

`public/messenger/solution/` — снимок решения ДЗ 2: его строки показывают гонки, его же запускает живой чат. `public/messenger/data/logs/full.log` — прогон `docker run --privileged … distsys.ru/course/grpc-messenger`, `public/messenger/data/results.json` собирается из него:

```sh
python scripts/messenger_results.py public/messenger/data/logs/full.log "distsys.ru/course/grpc-messenger@sha256:…" > public/messenger/data/results.json
```
