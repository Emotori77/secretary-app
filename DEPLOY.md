# Cloudflare Pages へのデプロイ手順

このアプリは **Cloudflare Pages（画面）＋ Pages Functions（API）＋ KV（データ保存）** で動きます。
`functions/api/[[path]].js` が旧 `server.js` の代わりに `/api/*` を処理し、データは **KV ネームスペース `DATA`** に保存されます。

---

## 1. KV ネームスペースを作る
1. Cloudflare ダッシュボード → 左メニュー **Storage & Databases → KV**（または **Workers & Pages → KV**）
2. **Create a namespace** → 名前を `rina-data` などにして作成

## 2. Pages プロジェクトを作る（GitHub連携）
1. **Workers & Pages → Create → Pages → Connect to Git**
2. リポジトリ **`Emotori77/secretary-app`** を選択 → **Begin setup**
3. ビルド設定：
   - **Framework preset**：`None`
   - **Build command**：空欄のまま
   - **Build output directory**：`/`（ルート。空欄でも可）
4. **Save and Deploy**（最初のデプロイが走ります）

## 3. KV をプロジェクトにバインドする（超重要）
1. 作成した Pages プロジェクト → **Settings → Functions**（または **Bindings**）
2. **KV namespace bindings → Add binding**
   - **Variable name**：`DATA`  ← この名前でないと動きません
   - **KV namespace**：手順1で作った `rina-data` を選択
3. 保存

## 4. （任意）AI対話「りな」を本物にする
1. **Settings → Environment variables** → **Add**
   - **Variable name**：`ANTHROPIC_API_KEY`
   - **Value**：あなたのAnthropic APIキー（`sk-ant-...`）
   - **Encrypt**（秘密として保存）にしておく
2. 未設定でも、りなは簡易版（ルールベース）で動きます。

## 5. 再デプロイ
バインドや環境変数は **次のデプロイから有効**です。
**Deployments → 最新のデプロイの「…」→ Retry deployment**（または GitHub に何かpushする）で再デプロイしてください。

これで `https://<プロジェクト名>.pages.dev` で本番アプリが動きます（保存もされます）。

---

## ⚠️ セキュリティ上の大事な注意
- **公開URLは、知っている人なら誰でもアクセスできます。** このアプリは個人の予定・メモを扱うので、URLを他人に教えないでください。
- 自分だけに限定したい場合は **Cloudflare Access（Zero Trust）** を設定すると、**自分のメール宛のログイン**でしか開けなくできます（無料枠あり）。
  - Zero Trust → Access → Applications → Add → Self-hosted → あなたの `*.pages.dev` を指定 → ポリシーで自分のメールのみ許可。

## メモ
- ローカル開発は今まで通り `node server.js` でOK（`server.js` は残してあります）。
- データ保存は KV を1つのキー(`data`)にまとめて読み書きします。ごく短時間に大量の連続書き込みをすると、KVの仕様上まれに反映が遅れることがあります（個人利用では通常問題ありません）。より厳密にしたい場合は D1 への移行も可能です。
