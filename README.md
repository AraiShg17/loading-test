# フロントエンド大量データ パフォーマンス検証アプリ

ブラウザ上で大量データを生成し、フロントエンド実装だけでどこまで高速化できるかを比較・計測するアプリです。

バックエンドやデータベースの最適化ではなく、`filter`、`reduce`、`useMemo`、`Map.get()`、`Index`、`Web Worker`、`TypedArray` などのフロントエンド実装差分を実測します。

公開URL:

https://loading-test-6alspl35pq-an.a.run.app

## 比較対象

- `filter` / `reduce`
- `useMemo`
- `Map.get()`
- `Index`
- `Web Worker`
- `TypedArray`
- Recharts / Chart.js

## 検証内容

- 10,000 ～ 50,000,000件のランダムデータ生成
- TypedArray を利用した大規模データ保持
- `filter` + `reduce` の基準ケース
- `useMemo` による再計算削減
- `Map.get()` と `find()` の比較
- Index による検索範囲削減
- Web Worker による UI ブロック軽減
- Recharts / Chart.js の描画比較
- Performance API による処理時間計測

## 計測項目

- filter時間
- 平均計算時間
- chart更新時間
- 合計処理時間
- UI最大停止時間
- Worker往復時間
- Map lookup時間
- 走査件数

## データ

データは特定業界に依存しない抽象的な会社データです。100社程度、複数部門、60か月分のランダムな売上・顧客数・案件数・稼働率を生成します。

```ts
type BusinessRecord = {
  id: number;
  companyId: number;
  companyName: string;
  businessUnit: "営業" | "開発" | "マーケティング" | "カスタマーサクセス" | "管理" | "人事";
  month: string;
  revenue: number;
  customerCount: number;
  projectCount: number;
  utilization: number;
};
```

5,000,000件までは `BusinessRecord[]`、10,000,000件以上は TypedArray のカラム形式で保持します。

## Indexの考え方

通常の `filter` は全件を見ます。

```ts
records.filter((record) => record.companyId === selectedCompanyId);
```

Index を使う場合は、先に会社・部門・月ごとの箱を作っておきます。

```ts
byCompany.get(companyId);
byBusinessUnit.get(businessUnit);
byMonth.get(month);
```

フィルター時は一番小さい候補だけを走査し、全件スキャンを避けます。数千万件のデータでは、会社 x 部門 x 月 の集計Indexを作り、集計済みの値を読むことでさらに走査量を減らします。

## Web Worker

Web Worker は処理時間そのものを必ず短縮するものではありません。重い filter / reduce / 集計処理をメインスレッド外へ移し、UI の停止感を減らすための比較対象です。

履歴の `UI最大停止` を同期処理ケースと比較すると、UX上の差を確認できます。

## 起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

## 注意

50,000,000件の生成・集計はブラウザ側の CPU とメモリを大きく使います。Cloud Run 側で大量データを生成しているわけではないため、主な負荷は閲覧している端末にかかります。

スマートフォンでは大きな件数を選ぶと処理が重くなる可能性があります。
