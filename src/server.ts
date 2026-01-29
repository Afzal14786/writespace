import app from "./app";
import "./shared/queues/email.worker";
import "./shared/queues/interaction.worker";

const PORT = process.env.PORT;

app
  .listen(PORT, () => {
    console.log(`Server is running on port no ${PORT}`);
  })
  .on("error", (err) => {
    console.log(`Error while running the server : ${err}`);
    process.exit(1);
  });
