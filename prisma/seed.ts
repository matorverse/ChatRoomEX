import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("ChangeMeInProduction123!");
  const user = await prisma.user.upsert({
    where: { handle: "demo" },
    update: {},
    create: {
      handle: "demo",
      displayName: "Demo Guide",
      passwordHash
    }
  });

  const room = await prisma.room.upsert({
    where: { slug: "sanctuary" },
    update: {},
    create: {
      slug: "sanctuary",
      name: "Sanctuary",
      description: "A calm realtime room for product validation.",
      createdById: user.id
    }
  });

  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    update: { role: "owner", canModerate: true },
    create: { roomId: room.id, userId: user.id, role: "owner", canModerate: true }
  });

  await prisma.message.createMany({
    data: [
      { roomId: room.id, authorId: user.id, body: "Welcome to ChatRoomEX. This seed verifies chat hydration." },
      { roomId: room.id, authorId: user.id, body: "Try sending a message, toggling reactions, and reconnecting." }
    ],
    skipDuplicates: true
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
