# Shopify review promotions（ハーネス用メモ）

このファイルは **AWS infra bootstrap に対する review** やデプロイ運用で繰り返し確認する不変条件を短く残す。アプリ固有の審査対応ではなく、テンプレート／CI のガードレール向け。

## Deploy / ECS

- **migration task の `exitCode` と service rollout の `services-stable`** をセットで見る。片方だけ成功でもロールアウトは未完扱いにする。
- **SHOPIFY_CLI_PARTNERS_TOKEN** など、ローカル専用シークレットを CI のレンダリングやビルドコンテキストに混ぜない。
- **host dependency と local Shopify CLI state**（`~/.shopify` 等）は Docker build context に入れない。クリーンランナー前提の optional deploy path でも同様。
