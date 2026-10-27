export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface RichMessage {
  text: string;
  reply_markup?: InlineKeyboardMarkup;
}

// Strings keep jobs prepared by earlier deployments readable during upgrades.
export type OutgoingMessage = string | RichMessage;
