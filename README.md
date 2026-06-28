# Kadr Forge

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F.svg)](https://electronjs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey.svg)]()

**GPU-ускоренный многодорожечный видеоредактор со встроенным ИИ-агентом прямо в таймлайне.**

Форк [HelpFreedom/kadr](https://github.com/HelpFreedom/kadr), объединяющий лучшие наработки community: фиксы под Windows, украинскую локализацию и переключаемую мультиагентную систему (Claude Code / Codex).

---

## ✨ Возможности

- **WebGL2-композитинг** — превью = рендер, один движок рисует и то, и другое
- **Кеёфреймы везде** — позиция, масштаб, поворот, маски, как в After Effects
- **Встроенный ИИ-агент в таймлайне** — Claude Code или Codex по выбору, видит и редактирует твой проект live через MCP
- **Локальное распознавание речи** — faster-whisper, авто-субтитры в стиле караоке, бандл Python включён, ничего ставить отдельно не нужно
- **Remotion-фрагменты** — программируемая моушн-графика на React/TSX прямо как клипы таймлайна
- **26 переходов**, 3D-наклоны клипов, дымное сияние и другие эффекты
- **Кросс-платформенно** — нативная сборка под Linux (AppImage / pacman) и Windows (NSIS-инсталлятор)
- **Локализация** — українська, русский, English

## 📦 Установка

### Linux
Скачай готовый `.AppImage` или `.pacman` со страницы [Releases](../../releases), либо собери сам:
```bash
git clone https://github.com/<твой-логин>/kadr-forge.git
cd kadr-forge
npm install
npm run dist:linux
```

### Windows
Скачай инсталлятор со страницы [Releases](../../releases), либо собери сам:
```powershell
git clone https://github.com/<твой-логин>/kadr-forge.git
cd kadr-forge
npm install
npm run dist:win
```

## 🚀 Разработка

```bash
npm install
npm run dev        # запуск в режиме разработки
npm run typecheck  # проверка типов
```

## 🤖 ИИ-агент

Нажми кнопку 🤖 на панели — откроется терминальная сессия с Claude Code или Codex (выбор переключается прямо там). Агент подключён к проекту через локальный MCP-сервер с инструментами:

| Инструмент | Назначение |
|---|---|
| `kadr_state` | читает текущий проект |
| `kadr_eval` | редактирует таймлайн |
| `kadr_export` | рендерит итог |
| `kadr_transcribe` | распознаёт речь |
| `kadr_fragment_create` | создаёт Remotion-композиции |

## 🙏 Благодарности

Этот форк не существовал бы без работы:
- **[HelpFreedom](https://github.com/HelpFreedom/kadr)** — оригинальный проект
- **[sergqwer](https://github.com/sergqwer/kadr)** — фиксы экспорта/транскрипции на Windows, украинская локаль, бандл ffmpeg+Python
- **[ArmanAirapetov](https://github.com/ArmanAirapetov/kadr)** — переключаемая мультиагентная система (Codex)

## 📄 Лицензия

GPL-3.0 — см. [LICENSE](LICENSE)
