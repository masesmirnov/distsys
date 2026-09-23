# Гарантии доставки

Страница для защиты ДЗ 1 по распределённым системам: AMO, ALO, EO и EOO в живой симуляции поверх настоящего кода решения, замеры ресурсов из прогонов тестов курса, баг в проверке порядка и общая доска, на которой все открывшие ссылку рисуют вместе.

Работает на [guarantees.maserov.com](https://guarantees.maserov.com). Устанавливается из `masesmirnov/infra` скриптом `scripts/deploy_guarantees.py` по файлам, закреплённым хешами в `locks/guarantees.json`.

## Запуск

Нужен только Node.js 20+, зависимостей нет.

```sh
node server.js
```

Сервер слушает `127.0.0.1:8094` (`PORT` и `HOST` меняют адрес), отдаёт `public/` и держит доску: SSE `/api/stream` и `POST /api/ops`. Рисунки живут в памяти и пропадают после суток без посетителей.

## Данные

`public/data/guarantees.py` — снимок решения, симуляция показывает его строки. `public/data/logs/` — логи прогонов Docker-образа курса: `full-4.0.log` с параметрами проверяющей системы `-m 100 -c -o`, остальные — `-o` для вариантов с другим `RESEND_DELAY` и другим хранением дырок. `public/data/results.json` собирается из них, лимиты берутся из исходника тестов:

```sh
python scripts/results.py public/data/logs ../hse-2026/homework/01-guarantees/tests/src/common.rs "distsys.ru/course/guarantees@sha256:…" > public/data/results.json
```
