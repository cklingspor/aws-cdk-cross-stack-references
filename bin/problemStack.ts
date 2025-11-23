#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { UserServiceStack } from "../lib/producer";
import { OrderServiceStack } from "../lib/consumer-with-csr";
import { ConfigBasedUserServiceStack } from "../lib/producer-config-based";
import { ConfigBasedOrderServiceStack } from "../lib/consumer-config-based";

const app = new cdk.App();

// This is the combination WITH cross stack reference
const userServiceStack = new UserServiceStack(app, "UserService");
new OrderServiceStack(app, "OrderService", {
  usersTable: userServiceStack.usersTable,
});

// Config based example. Stacks names for clarity
const tableName = "Users";
new ConfigBasedUserServiceStack(app, "ConfigBasedUserService", {
  usersTableName: tableName,
});
new ConfigBasedOrderServiceStack(app, "ConfigBasedOrderService", {
  usersTableName: tableName,
});
