import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Plan } from '../../database/models/plans.model';
import { PaymentProvider, PaymentTypes, Transaction, TransactionStatus } from '../../database/models/transactions.model';
import logger from '../../utils/logger';
import { Bot, InlineKeyboard } from 'grammy';
import { UserModel } from '../../database/models/user.model';
import { SubscriptionService } from '../../services/subscription.service';

type CreatePaymentParams = {
    userId: string;
    selectedSport: string;
    telegramId?: number;
    test?: boolean;
};

@Injectable()
export class OctoService {
    private readonly preparePaymentUrl = 'https://secure.octo.uz/prepare_payment';

    constructor(private readonly configService: ConfigService) { }

    private formatInitTime(date: Date = new Date()): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        const hours = `${date.getHours()}`.padStart(2, '0');
        const minutes = `${date.getMinutes()}`.padStart(2, '0');
        const seconds = `${date.getSeconds()}`.padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    private resolvePlanName(selectedSport: string): string {
        return selectedSport === 'wrestling' ? 'Yakka kurash' : 'Futbol';
    }

    async createOneTimePayment(params: CreatePaymentParams): Promise<{
        payUrl: string;
        octoPaymentUUID: string;
        shopTransactionId: string;
    }> {
        const octoShopId = this.configService.get<number>('OCTO_SHOP_ID');
        const octoSecret = this.configService.get<string>('OCTO_SECRET_KEY');

        if (!octoShopId || !octoSecret) {
            throw new Error('Octo credentials are not configured');
        }

        const planName = this.resolvePlanName(params.selectedSport);
        const plan = await Plan.findOne({ name: planName });

        if (!plan) {
            throw new Error(`Plan not found for sport: ${params.selectedSport}`);
        }

        const shopTransactionId = `${plan._id}-${params.userId}-${Date.now()}`;
        const overrideAmount = this.configService.get<number>('OCTO_TEST_AMOUNT');

        const payload: Record<string, any> = {
            octo_shop_id: Number(octoShopId),
            octo_secret: octoSecret,
            shop_transaction_id: shopTransactionId,
            auto_capture: true,
            init_time: this.formatInitTime(),
            total_sum: overrideAmount ?? plan.price,
            currency: 'UZS',
            description: `One-time payment for ${planName}`,
        };

        const returnUrl = this.configService.get<string>('OCTO_RETURN_URL');
        const notifyUrl = this.configService.get<string>('OCTO_NOTIFY_URL');
        const language = this.configService.get<string>('OCTO_LANGUAGE') || 'uz';
        const forceTest = this.configService.get<string>('OCTO_TEST_MODE') === 'true';

        if (params.test || forceTest) payload.test = true;
        if (returnUrl) payload.return_url = returnUrl;
        if (notifyUrl) payload.notify_url = notifyUrl;
        if (language) payload.language = language;

        try {
            const response = await axios.post(this.preparePaymentUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
            });

            if (!response.data || response.data.error) {
                logger.error(`Octo error: ${JSON.stringify(response.data)}`);
                throw new Error(response.data?.errMessage || 'Failed to create Octo payment');
            }

            const data = response.data.data || response.data;

            await Transaction.create({
                provider: PaymentProvider.OCTO,
                paymentType: PaymentTypes.ONETIME,
                amount: plan.price,
                userId: params.userId,
                planId: plan._id,
                status: TransactionStatus.CREATED,
                transId: data.octo_payment_UUID,
                selectedSport: params.selectedSport,
            });

            return {
                payUrl: data.octo_pay_url,
                octoPaymentUUID: data.octo_payment_UUID,
                shopTransactionId,
            };
        } catch (error: any) {
            logger.error('Failed to initiate Octo payment', error);
            throw new Error(error?.message || 'Failed to initiate Octo payment');
        }
    }

    /**
     * Handle Octo push notification.
     */
    async handleNotification(body: any): Promise<void> {
        const { octo_payment_UUID: paymentUUID, status } = body || {};
        if (!paymentUUID || !status) {
            throw new Error('Missing payment UUID or status');
        }

        const tx = await Transaction.findOne({ transId: paymentUUID, provider: PaymentProvider.OCTO });
        if (!tx) {
            logger.warn(`Octo notify: transaction not found for ${paymentUUID}`);
            return;
        }

        // Basic status mapping
        switch (status) {
            case 'paid':
            case 'captured':
                tx.status = TransactionStatus.PAID;
                break;
            case 'canceled':
            case 'failed':
            case 'rejected':
                tx.status = TransactionStatus.CANCELED;
                break;
            default:
                logger.info(`Octo notify: received status ${status} for ${paymentUUID}`);
                break;
        }

        await tx.save();

        // If payment is successful, auto-activate subscription and notify user.
        if (tx.status === TransactionStatus.PAID) {
            try {
                const botToken = this.configService.get<string>('BOT_TOKEN');
                if (!botToken) {
                    logger.error('BOT_TOKEN not configured, cannot send Telegram message');
                    return;
                }

                const bot = new Bot(botToken);
                // SubscriptionService expects the project's BotContext (with session), but here we only have a plain Bot instance.
                // Cast to any to avoid TypeScript generic mismatch in this webhook handler.
                const subscriptionService = new SubscriptionService(bot as any);

                const plan = await Plan.findById(tx.planId);
                const user = await UserModel.findById(tx.userId);

                if (!plan) {
                    logger.error(`Octo notify: plan not found for transaction ${paymentUUID}`);
                    return;
                }

                if (!user) {
                    logger.error(`Octo notify: user not found for transaction ${paymentUUID}`);
                    return;
                }

                const { user: subscription } = await subscriptionService.createSubscription(
                    tx.userId.toString(),
                    plan,
                    user.username,
                );

                // Always mark user as subscribed to football and use the football channel invite.
                await UserModel.updateOne({ _id: user._id }, { $set: { subscribedTo: 'football' } });

                const channelId = this.configService.get<string>('CHANNEL_ID');

                try {
                    const privateLink = await bot.api.createChatInviteLink(channelId as string, {
                        member_limit: 1,
                        expire_date: 0,
                        creates_join_request: false,
                    });

                    const keyboard = new InlineKeyboard()
                        .url('🔗 Kanalga kirish', privateLink.invite_link)
                        .row()
                        .text('🔙 Asosiy menyu', 'main_menu');

                    const endDate = subscription.subscriptionEnd;
                    const endFormatted = endDate ? `${endDate.getDate().toString().padStart(2, '0')}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getFullYear()}` : '';

                    const message = `🎉 Tabriklaymiz! To'lov muvaffaqiyatli amalga oshirildi.\n\n⏰ Obuna tugash muddati: ${endFormatted}\n\nQuyidagi havola orqali kanalga kirishingiz mumkin:`;

                    if (user.telegramId) {
                        await bot.api.sendMessage(Number(user.telegramId), message, {
                            reply_markup: keyboard,
                            parse_mode: 'HTML',
                        });
                    } else {
                        logger.warn(`Octo notify: user ${user._id} has no telegramId, cannot send invite link`);
                    }
                } catch (err) {
                    logger.error(`Failed to create/send invite link for transaction ${paymentUUID}: ${err}`);
                }

            } catch (err) {
                logger.error(`Error processing Octo paid notification for ${paymentUUID}: ${err}`);
            }
        }
    }
}
