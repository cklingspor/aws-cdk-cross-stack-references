import * as cdk from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

interface OrderServiceStackProps extends cdk.StackProps {
  usersTableName: string;
}

export class ConfigBasedOrderServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrderServiceStackProps) {
    super(scope, id, props);

    const usersTable = TableV2.fromTableAttributes(this, "ImportedUsersTable", {
      tableName: props.usersTableName,
      globalIndexes: [], // Add indexes if needed for grants
    });

    const readUser = new NodejsFunction(this, "OrderFunction", {
      entry: "./lib/lambdas/handler.ts",
      environment: {
        USER_TABLE_NAME: props.usersTableName,
      },
    });

    usersTable.grantReadData(readUser);
  }
}
