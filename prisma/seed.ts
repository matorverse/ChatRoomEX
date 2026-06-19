import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("ChangeMeInProduction123!");
  
  // Create a demo user who is also a Global Admin
  const user = await prisma.user.upsert({
    where: { handle: "demo" },
    update: { globalRole: "admin" },
    create: {
      handle: "demo",
      displayName: "Demo Guide",
      passwordHash,
      globalRole: "admin"
    }
  });

  // Seed Default Rooms
  const defaultRooms = [
    { slug: "lobby", name: "Lobby", description: "Lobby chatroom: Talk, learn, and socialize." },
    { slug: "help", name: "Help", description: "Help chatroom: Ask questions and get support." },
    { slug: "tournaments", name: "Tournaments", description: "Tournaments chatroom: Where all the matches happen." },
    { slug: "malayalam", name: "Malayalam", description: "Speak and chat in Malayalam." }
  ];

  for (const r of defaultRooms) {
    const room = await prisma.room.upsert({
      where: { slug: r.slug },
      update: {},
      create: {
        slug: r.slug,
        name: r.name,
        description: r.description,
        createdById: user.id
      }
    });

    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
      update: { role: "owner", canModerate: true },
      create: { roomId: room.id, userId: user.id, role: "owner", canModerate: true }
    });

    // Create a greeting message
    await prisma.message.create({
      data: {
        roomId: room.id,
        authorId: user.id,
        body: `Welcome to the ${r.name} room!`
      }
    });
  }
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
