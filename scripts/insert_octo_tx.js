// Insert a test Octo transaction (status CREATED) for the found user and plan
const { MongoClient, ObjectId } = require('mongodb');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { MONGODB_URI } = process.env;
if (!MONGODB_URI) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
}

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db();

    const plans = db.collection('plans');
    const users = db.collection('users');
    const transactions = db.collection('transactions');

    const plan = await plans.findOne({ name: { $regex: /Futbol/i } });
    const user = await users.findOne({ telegramId: { $exists: true, $ne: null } });

    if (!plan || !user) {
        console.error('Plan or user not found. plan=', !!plan, 'user=', !!user);
        await client.close();
        process.exit(1);
    }

    const transId = `TEST-${randomUUID()}`;

    const now = new Date();
    const txDoc = {
        provider: 'OCTO',
        paymentType: 'ONETIME',
        amount: plan.price,
        userId: user._id,
        planId: plan._id,
        status: 'CREATED',
        transId,
        selectedSport: 'football',
        createdAt: now,
        updatedAt: now,
    };

    const res = await transactions.insertOne(txDoc);
    console.log('Inserted tx:', { _id: res.insertedId.toString(), transId, userId: user._id.toString(), planId: plan._id.toString() });

    await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
