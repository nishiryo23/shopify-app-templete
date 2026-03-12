import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prismaGlobal?: PrismaClient;
};

if (process.env.NODE_ENV !== "production" && !globalForPrisma.prismaGlobal) {
  globalForPrisma.prismaGlobal = new PrismaClient();
}

const prisma = globalForPrisma.prismaGlobal ?? new PrismaClient();

export default prisma;
