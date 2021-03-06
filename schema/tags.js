export default {
  properties: {
    title: { type: 'keyword' },
    description: { type: 'text', analyzer: 'cjk' },

    // auth
    userId: { type: 'keyword' },
    appId: { type: 'keyword' },

    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};
