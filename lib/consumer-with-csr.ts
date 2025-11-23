import * as cdk from "aws-cdk-lib";
import { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

interface OrderServiceStackProps extends cdk.StackProps {
  usersTable: ITableV2;
}

export class OrderServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrderServiceStackProps) {
    super(scope, id, props);

    const readUser = new NodejsFunction(this, "OrderFunction", {
      entry: "./lib/lambdas/handler.ts",
      environment: {
        USER_TABLE: props.usersTable.tableName,
      },
    });

    props.usersTable.grantReadData(readUser);
  }
}
