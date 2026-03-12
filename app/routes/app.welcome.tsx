export default function WelcomeRoute() {
  return (
    <div data-testid="welcome-shell">
      <s-page heading="Welcome">
        <s-section heading="Welcome shell">
          <s-paragraph>
            managed install 後の導線確認用 shell です。entitlement truth はまだ付与しません。
          </s-paragraph>
        </s-section>
      </s-page>
    </div>
  );
}
