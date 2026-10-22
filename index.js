const express = require('express');
const { createServer } = require('http');
const { ApolloServer, gql, UserInputError } = require('apollo-server-express');
const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { PubSub, withFilter } = require('graphql-subscriptions');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/use/ws');

// This in-memory store and event bus are shared by queries and mutations.
const users = [
  { id: '1', name: 'John Doe', email: 'john.doe@example.com' },
  { id: '2', name: 'Jane Doe', email: 'jane.doe@example.com' },
];
const pubsub = new PubSub();
const USER_UPDATED = 'USER_UPDATED';

// Define the GraphQL schema
const typeDefs = gql`
  type Query {
    hello: String
    getUser(id: ID!): User
  }

  type Mutation {
    updateUser(id: ID!, name: String, email: String): User!
  }

  type Subscription {
    userUpdated(id: ID): User!
  }

  type User {
    id: ID!
    name: String
    email: String
  }
`;

// Define resolvers to fetch data
const resolvers = {
  Query: {
    hello: () => 'Hello, world!',
    getUser: (_, { id }) => {
      return users.find(user => user.id === id);
    },
  },
  Mutation: {
    updateUser: async (_, { id, name, email }) => {
      const index = users.findIndex(user => user.id === id);
      if (index === -1) {
        throw new UserInputError(`User with id ${id} was not found`);
      }

      const user = {
        ...users[index],
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
      };
      users[index] = user;
      await pubsub.publish(USER_UPDATED, { userUpdated: user });
      return user;
    },
  },
  Subscription: {
    userUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator(USER_UPDATED),
        (payload, { id }) => id == null || payload.userUpdated.id === id,
      ),
    },
  },
};

// HTTP and WebSocket operations use the same executable schema.
const schema = makeExecutableSchema({ typeDefs, resolvers });
const app = express();
const httpServer = createServer(app);
const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });
const serverCleanup = useServer({ schema }, wsServer);
const server = new ApolloServer({
  schema,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

// Start the Apollo server before applying middleware
const startServer = async () => {
  await server.start(); // Ensure the server is started
  server.applyMiddleware({ app }); // Apply middleware after the server has started

  // Define the port and start the Express app
  const PORT = 4000;
  httpServer.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}${server.graphqlPath}`);
    console.log(`Subscriptions running at ws://localhost:${PORT}/graphql`);
  });
};

// Initialize the server
startServer();
