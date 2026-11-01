# Уведомления о сторонних компонентах

Проверка от 1 ноября 2026 года: прямые runtime- и dev-зависимости из package.json, фактически установленные версии и их лицензионные метаданные; присутствующие тексты LICENSE/NOTICE; видимые сторонние материалы приложения. Версии сверены с package-lock.json. Это **не полный аудит транзитивного дерева, нативных библиотек, браузера или всех встроенных компонентов**.

Сторонние компоненты сохраняют собственные лицензии и авторство; AGPL-3.0-only Grelqa не заменяет их условия. Полные доступные уведомления собраны в third_party/notices/ без удаления copyright-строк; внутри сборных файлов границы исходных файлов отмечены заголовками. Их исходные SHA-256 и происхождение указаны в [manifest](third_party/notices-manifest.json). Это сохранение уведомлений, а не проверка всего кода этих компонентов.

| Компонент | Установленная версия | Заявленная лицензия | Использование | Уведомления и происхождение |
| --- | --- | --- | --- | --- |
| `@libsql/client` | 0.18.0 | MIT | runtime | [libsql-client.txt](third_party/notices/libsql-client.txt); LICENSE отсутствует в пакете; upstream |
| `@node-rs/argon2` | 2.2.2 | MIT | runtime | [node-rs-argon2.txt](third_party/notices/node-rs-argon2.txt); из установленного пакета |
| `@tiptap/core` | 3.32.2 | MIT | runtime | [tiptap-core.txt](third_party/notices/tiptap-core.txt); из установленного пакета |
| `@tiptap/pm` | 3.32.2 | MIT | runtime | [tiptap-pm.txt](third_party/notices/tiptap-pm.txt); из установленного пакета |
| `@tiptap/react` | 3.32.2 | MIT | runtime | [tiptap-react.txt](third_party/notices/tiptap-react.txt); из установленного пакета |
| `@tiptap/starter-kit` | 3.32.2 | MIT | runtime | [tiptap-starter-kit.txt](third_party/notices/tiptap-starter-kit.txt); из установленного пакета |
| `dotenv` | 17.2.3 | BSD-2-Clause | runtime | [dotenv.txt](third_party/notices/dotenv.txt); из установленного пакета |
| `drizzle-orm` | 0.45.4 | Apache-2.0 | runtime | [drizzle-orm.txt](third_party/notices/drizzle-orm.txt); LICENSE отсутствует в пакете; upstream |
| `fflate` | 0.8.3 | MIT | runtime | [fflate.txt](third_party/notices/fflate.txt); из установленного пакета |
| `iron-session` | 9.0.1 | MIT | runtime | [iron-session.txt](third_party/notices/iron-session.txt); из установленного пакета |
| `next` | 16.4.3 | MIT | runtime | [next.txt](third_party/notices/next.txt); из установленного пакета |
| `nodemailer` | 10.3.1 | MIT-0 | runtime | [nodemailer.txt](third_party/notices/nodemailer.txt); из установленного пакета |
| `react` | 19.3.1 | MIT | runtime | [react.txt](third_party/notices/react.txt); из установленного пакета |
| `react-dom` | 19.3.1 | MIT | runtime | [react-dom.txt](third_party/notices/react-dom.txt); из установленного пакета |
| `server-only` | 0.0.1 | MIT | runtime | не поставляется; MIT в метаданных; точное уведомление отсутствует |
| `zod` | 4.6.7 | MIT | runtime | [zod.txt](third_party/notices/zod.txt); из установленного пакета |
| `@types/node` | 26.6.6 | MIT | dev | [types-node.txt](third_party/notices/types-node.txt); из установленного пакета |
| `@types/nodemailer` | 8.0.2 | MIT | dev | [types-nodemailer.txt](third_party/notices/types-nodemailer.txt); из установленного пакета |
| `@types/react` | 19.3.0 | MIT | dev | [types-react.txt](third_party/notices/types-react.txt); из установленного пакета |
| `@types/react-dom` | 19.3.0 | MIT | dev | [types-react-dom.txt](third_party/notices/types-react-dom.txt); из установленного пакета |
| `drizzle-kit` | 0.31.11 | MIT | dev | [drizzle-kit.txt](third_party/notices/drizzle-kit.txt); MIT в метаданных; отдельный текст отсутствует; bundled notices сохранены |
| `eslint` | 10.14.0 | MIT | dev | [eslint.txt](third_party/notices/eslint.txt); из установленного пакета |
| `eslint-config-next` | 16.4.3 | MIT | dev | [eslint-config-next.txt](third_party/notices/eslint-config-next.txt); уведомление Next.js той же версии |
| `playwright-core` | 1.58.2 | Apache-2.0 | dev | [playwright-core.txt](third_party/notices/playwright-core.txt); из установленного пакета |
| `saxes` | 6.0.0 | ISC | dev | [saxes.txt](third_party/notices/saxes.txt); LICENSE отсутствует в пакете; upstream |
| `tsx` | 4.23.15 | MIT | dev | [tsx.txt](third_party/notices/tsx.txt); из установленного пакета |
| `typescript` | 5.9.3 | Apache-2.0 | dev | [typescript.txt](third_party/notices/typescript.txt); из установленного пакета |

## Границы и неясности

- По заявленным лицензиям прямых зависимостей (MIT, MIT-0, ISC, BSD-2-Clause, Apache-2.0) явной несовместимости с AGPL-3.0-only не обнаружено. Условия сохранения уведомлений стороннего кода продолжают действовать. Это не утверждение о совместимости каждого транзитивного или встроенного компонента.
- В точных установленных пакетах и проверенных npm-tarball нет отдельного LICENSE у @libsql/client, drizzle-orm, drizzle-kit, server-only, eslint-config-next и saxes. Метаданные точных npm-версий проверены отдельно. Для libSQL и saxes текст получен из upstream по gitHead соответствующего npm-релиза; для eslint-config-next сохранён MIT-текст Next.js той же установленной версии.
- Для drizzle-orm сохранён Apache-2.0 текст из корня официального upstream main; соответствие точному коммиту 0.45.4 не установлено. Для drizzle-kit точные метаданные указывают MIT, но отдельного MIT-уведомления выпуска нет; корневой LICENSE монорепозитория — Apache-2.0. Они не подменены друг другом: область условий конкретной сборки Kit и недостающую MIT-атрибуцию следует уточнить у upstream перед распространением этой сборки. Это не доказанная несовместимость, а неустранённая неясность поставки уведомлений.
- server-only 0.0.1 заявляет MIT и страницу React, но не содержит собственного copyright/текста лицензии и не предоставляет gitHead. Точное уведомление этого выпуска остаётся неустановленным; чужое имя из React/Git не подставлено автоматически.
- Сохранены предоставленные @tiptap/pm уведомления ProseMirror, дополнительные лицензии bundled-модулей next/dist/compiled, LICENSE/NOTICE/ThirdPartyNotices Playwright, TypeScript ThirdPartyNoticeText и обнаруженные embedded notices Drizzle Kit. Это не означает проверку каждого упомянутого или транзитивного пакета.
- При распространении нативных артефактов libSQL/Argon2, отдельного Node.js или Chromium необходимо отдельно сохранить их релевантные лицензии. Внешний Chromium используется тестами через CHROMIUM_PATH и не включён в репозиторий. Уведомления установленного Playwright не заменяют аудит выбранного бинарника Chromium.

## Шрифты, изображения, иконки и фрагменты

В приложении используются системные CSS-стеки Arial/Helvetica и Georgia/Times New Roman. Файлы шрифтов не распространяются; их названия не перелицензируют системные шрифты. В отслеживаемых материалах приложения не найдены поставляемые изображения, файлы иконок, SVG или веб-шрифты; графические знаки интерфейса — текст/Unicode/CSS.

Поиск по src/, scripts/, tests/ и документам не обнаружил помеченных сторонних скопированных прикладных фрагментов с отдельными уведомлениями. Это поиск явных признаков, а не доказательство происхождения каждой строки. Генерируемые Next.js файлы и инструкции остаются связанными с Next.js; его MIT-уведомление сохранено. Внешние ссылки на документацию и NobelPrize.org не предоставляют права копировать содержимое этих сайтов.

## Демонстрационные литературные тексты

scripts/demo-stories.ts содержит вымышленные гонзо-репортажи, созданные при разработке проекта; комментарий файла указывает original fictional reports / no quotations. Их прочитанное содержимое и остальные demo-фикстуры не помечены как выдержки из опубликованных литературных произведений. Это не рассказы Хантера С. Томпсона и не заявление о получении прав на его произведения. Поиск совпадений по внешнему корпусу литературы не выполнялся; абсолютная оригинальность не подтверждается этим просмотром.

Литературное содержимое демонстрационных данных, как и загруженные пользовательские рассказы, **не объявляется автоматически AGPL** вместе с программной логикой seed и движка. Отдельных условий лицензирования демонстрационных литературных текстов в проекте пока нет; правообладателю следует определить их отдельно перед распространением как самостоятельного контента. Пользовательские материалы и права их правообладателей не перелицензируются лицензией движка.
