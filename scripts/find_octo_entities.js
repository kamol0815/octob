// Quick helper script to inspect DB for Octo transactions, a plan and a user with telegramId
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { MONGODB_URI } = process.env;
if (!MONGODB_URI) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
}

async function main() {
    await mongoose.connect(MONGODB_URI, { dbName: undefined, useNewUrlParser: true, useUnifiedTopology: true }).catch(err => { console.error(err); process.exit(1); });

    const Plan = require('../dist/database/models/plans.model').Plan || require('../src/database/models/plans.model');
    const UserModel = require('../dist/database/models/user.model').UserModel || require('../src/database/models/user.model');
    const Transaction = require('../dist/database/models/transactions.model').Transaction || require('../src/database/models/transactions.model');

    const plan = await Plan.findOne({}).lean().exec().catch(err => { console.error('Plan query error', err); });
    const user = await UserModel.findOne({ telegramId: { $exists: true, $ne: null } }).lean().exec().catch(err => { console.error('User query error', err); });
    const tx = await Transaction.findOne({ provider: 'OCTO' }).sort({ createdAt: -1 }).lean().exec().catch(err => { console.error('Tx query error', err); });

    console.log('plan:', plan ? { _id: plan._id, name: plan.name, price: plan.price } : null);
    console.log('user(with telegramId):', user ? { _id: user._id, username: user.username, telegramId: user.telegramId } : null);
    console.log('latest octo tx:', tx ? { _id: tx._id, transId: tx.transId, status: tx.status, userId: tx.userId, planId: tx.planId } : null);

    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
