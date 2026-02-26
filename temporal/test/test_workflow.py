"""Simple Temporal workflow test to verify the cluster works end-to-end."""

import asyncio
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker


@activity.defn
async def say_hello(name: str) -> str:
    return f"Hello, {name}!"


@workflow.defn
class GreetingWorkflow:
    @workflow.run
    async def run(self, name: str) -> str:
        return await workflow.execute_activity(
            say_hello,
            name,
            start_to_close_timeout=timedelta(seconds=10),
        )


async def main():
    client = await Client.connect("temporal-frontend.temporal.svc.cluster.local:7233")

    async with Worker(
        client,
        task_queue="test-queue",
        workflows=[GreetingWorkflow],
        activities=[say_hello],
    ):
        result = await client.execute_workflow(
            GreetingWorkflow.run,
            "World",
            id="test-workflow-1",
            task_queue="test-queue",
        )
        print(f"Result: {result}")
        assert result == "Hello, World!", f"Expected 'Hello, World!' but got '{result}'"
        print("TEST PASSED: Temporal workflow executed successfully!")


if __name__ == "__main__":
    asyncio.run(main())
