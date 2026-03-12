export function createPrismaWebhookInboxStore(prisma) {
  return {
    async enqueueIfAbsent(record) {
      try {
        await prisma.webhookInbox.create({
          data: {
            deliveryKey: record.deliveryKey,
            eventId: record.eventId,
            shopDomain: record.shopDomain,
            topic: record.topic,
            webhookId: record.webhookId,
            subscriptionName: record.subscriptionName,
            rawBody: record.rawBody,
            hmacHeader: record.hmacHeader,
          },
        });

        return true;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          return false;
        }

        throw error;
      }
    },
  };
}
