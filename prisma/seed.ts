import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcrypt';
import * as config from '../config/settings.development.json';

const prisma = new PrismaClient();

type SeedAccount = {
  email: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  // ISO date; accounts with a future date are seeded as suspended (used by the E2E sign-in tests)
  suspendedUntil?: string;
};

async function main() {
  console.log('Seeding the database');
  const password = await hash('changeme', 10);
  // Upsert sequentially so every account exists before the client disconnects
  for (const account of config.defaultAccounts as SeedAccount[]) {
    const role = account.role as Role || Role.USER;
    console.log(`  Creating user: ${account.email} with role: ${role}`);
    // eslint-disable-next-line no-await-in-loop
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        password,
        role,
        suspendedUntil: account.suspendedUntil ? new Date(account.suspendedUntil) : null,
      },
    });

    // Create a profile for the user if it doesn't exist
    const firstName = account.firstName || account.email.split('@')[0];
    const lastName = account.lastName || 'User';
    const name = `${firstName} ${lastName}`;
    // eslint-disable-next-line no-await-in-loop
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        name,
        firstName,
        lastName,
        email: account.email,
      },
    });
  }
}
main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
