export default function AppIndexRoute() {
  return (
    <div data-testid="app-shell">
      <s-page heading="Shopify Matri">
        <s-section heading="埋め込みアプリの動作確認">
          <s-paragraph>
            `shopify app dev` で最小構成の埋め込みアプリが起動していることを確認するための
            画面です。
          </s-paragraph>
        </s-section>
      </s-page>
    </div>
  );
}
