const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({}, { strict: false });
const UserCardSchema = new mongoose.Schema({}, { strict: false });

const UserModel = mongoose.model('User', UserSchema, 'users');
const UserCardsModel = mongoose.model('UserCard', UserCardSchema, 'user_cards');

async function addTestSubscription() {
    try {
        await mongoose.connect('mongodb://localhost:27017/premium-content');
        console.log('✅ MongoDB ga ulanildi');

        // Foydalanuvchini topish
        const user = await UserModel.findOne({ telegramId: 7789445876 });
        if (!user) {
            console.log('❌ Foydalanuvchi topilmadi');
            process.exit(1);
        }

        console.log(`📱 Foydalanuvchi topildi: ${user.telegramId}`);

        // Obuna muddatini hisoblash
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);

        // Obunani yangilash
        await UserModel.updateOne(
            { telegramId: 7789445876 },
            {
                $set: {
                    isActive: true,
                    subscriptionStart: new Date(),
                    subscriptionEnd: endDate,
                    subscriptionType: 'subscription'
                }
            }
        );

        console.log('✅ Obuna faollashtirildi');
        console.log(`📅 Tugash sanasi: ${endDate.toLocaleDateString()}`);

        // Test karta qo'shish
        await UserCardsModel.create({
            userId: user._id,
            telegramId: 7789445876,
            cardType: 'uzcard',
            cardToken: 'test_token_123',
            cardNumber: '8600****1234',
            verified: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        console.log('✅ Test karta qo\'shildi');
        console.log('');
        console.log('🎉 TAYYOR! Endi Telegram botda "Obuna holati" ga kiring!');
        console.log('   "❌ Obunani bekor qilish" tugmasi ko\'rinadi!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Xatolik:', error.message);
        process.exit(1);
    }
}

addTestSubscription();
