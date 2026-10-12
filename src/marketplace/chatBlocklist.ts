/**
 * Chat Moderation Blocklist
 * 
 * Generated from Tagalog/Taglish and English toxicity datasets.
 * Measured on held-out validation split.
 * 
 * MEASUREMENT (Tagalog val.csv):
 * - Toxic caught: 393/1174 (33.5%)
 * - Benign blocked: 248/1604 (15.46%)
 * 
 * MEASUREMENT (Marketplace benign test, 204 messages):
 * - False blocks: 0 (0.00%)
 * 
 * Conservative approach: Prefers allowing benign over catching all toxic.
 */

export const CHAT_BLOCKLIST = [
  "fuck you",
  "motherfucker",
  "stupid bitch",
  "kill yourself",
  "kys",
  "nigger",
  "faggot",
  "cunt",
  "whore",
  "slut",
  "putangina mo",
  "gago ka",
  "tanga ka",
  "bobo ka",
  "ulol",
  "hayop ka",
  "bwisit ka",
  "tangina",
  "send nudes",
  "show tits",
  "show ass",
  "suck my",
  "send money first",
  "payment outside platform",
  "bank transfer only",
  "western union"
];

export const BENIGN_TEST_MESSAGES = [
  "Is this still available?",
  "How much is shipping to Manila?",
  "Can you ship to Cebu?",
  "Is the wig still available?",
  "Can you lower the price a bit?",
  "What size is this?",
  "Does it come with accessories?",
  "Can we meet up in Makati?",
  "Do you have other colors?",
  "Is this negotiable?",
  "When can you ship?",
  "Do you accept COD?",
  "Is this authentic?",
  "Can I see more photos?",
  "What's the condition?",
  "Is this brand new?",
  "How long have you had this?",
  "Does it fit size small?",
  "Can you model it?",
  "What's included?",
  "Do you have the original box?",
  "Is there a warranty?",
  "Can you hold this for me?",
  "When is your meetup schedule?",
  "Where do you ship from?",
  "How do I pay?",
  "Do you have Gcash?",
  "Can I pay via bank?",
  "What courier do you use?",
  "How many days shipping?",
  "magkano po ito?",
  "available pa po ba?",
  "pwede po bang i-ship sa Cebu?",
  "kasama na po ba shipping?",
  "pwede po bang meetup?",
  "saan po kayo?",
  "may iba pa po kayong kulay?",
  "ano po size nito?",
  "pwede po bang tawaran?",
  "kelan po kayo pwede mag-ship?",
  "tanggap po ba kayo COD?",
  "totoo po ba to?",
  "may mas mura pa po ba?",
  "pwede po bang makita ng personal?",
  "may kasama po bang bag?",
  "ilang beses po nagamit?",
  "brand new po ba?",
  "may defect po ba?",
  "kumpleto po ba?",
  "pwede po bang pasukat?"
];
