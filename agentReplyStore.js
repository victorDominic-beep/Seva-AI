// agentReplyStore.js
// ----------------------------------------------------
// Temporary in-memory store for agent replies
// ----------------------------------------------------

const pendingReplies = new Map();

// Store a new agent reply
function addReply(userId, message) {
  if (!pendingReplies.has(userId)) {
    pendingReplies.set(userId, []);
  }

  pendingReplies.get(userId).push(message);
}

// Get unread replies and clear them
function getReplies(userId) {
  const replies = pendingReplies.get(userId) || [];
  pendingReplies.delete(userId);
  return replies;
}

module.exports = {
  addReply,
  getReplies,
};