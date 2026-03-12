export default function AppIndexRoute() {
  return (
    <div data-testid="app-shell">
      <s-page heading="Shopify Matri">
        <s-section heading="Embedded shell">
          <s-paragraph>
            `shopify app dev` で最小の embedded shell が起動していることを確認するための
            画面です。
          </s-paragraph>
        </s-section>
      </s-page>
    </div>
  );
}
