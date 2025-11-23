import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AttributeType, ITableV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { StackProps } from "aws-cdk-lib";

interface UserServiceStackProps extends StackProps {
  usersTableName: string;
}

export class ConfigBasedUserServiceStack extends cdk.Stack {
  public readonly usersTable: ITableV2;

  constructor(scope: Construct, id: string, props: UserServiceStackProps) {
    super(scope, id, props);

    this.usersTable = new TableV2(this, "UsersTable", {
      tableName: props.usersTableName,
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
    });
  }
}
