import { Page, Layout, Card, BlockStack, Text } from "@shopify/polaris";

export default function AppIndexRoute() {
  return (
    <div data-testid="app-shell">
      <Page title="Shopify App">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">埋め込みアプリの動作確認</Text>
                <Text as="p" tone="subdued">
                  `shopify app dev` で最小構成の埋め込みアプリが起動していることを確認するための画面です。
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
