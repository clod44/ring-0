const { COLOR } = OS.require('/lib/cli.js');

if (args[0] === '-n') {
    OS.tty.print(args.slice(1).join(' '), COLOR.text);
} else {
    OS.tty.println(args.join(' '), COLOR.text);
}

return 0;
