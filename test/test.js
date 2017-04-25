describe('chrome-remote-js', function () {
    this.timeout(60000);
    it('wow', () => {
        const chrome = new (require('..'));

        const spawn = () => chrome.spawn();
        const connect = () => chrome.connect();
        const open = () => chrome.open('https://casino.mrgreen.com', 'finitus');

        return spawn()
            .then(connect)
            .then(open)
            .then(() => chrome._send({
                method: `DOM.querySelector`,
                params: {}
            })
            .then(console.log));

    })
});

