import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AttributeType, ITableV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";

export class UserServiceStack extends cdk.Stack {
  public readonly usersTable: ITableV2;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.usersTable = new TableV2(this, "UsersTable", {
      tableName: "Users",
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
    });
  }
}
